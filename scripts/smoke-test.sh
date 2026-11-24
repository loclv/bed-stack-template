#!/bin/bash
# E2E Smoke Test for Seat Reservation Microservices Architecture.
# Tests registration, locking, checkout, success saga, and failed payment compensation.

set -e

GATEWAY_URL="http://localhost:3000/api"
COOKIE_JAR="/tmp/smoke_test_cookies.txt"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Seat Reservation Microservices E2E Smoke Test ===${NC}"

# Clean up legacy cookies
rm -f "$COOKIE_JAR"

# 1. Login/Registration via Mock Login
echo -e "\n1. Authenticating user via Gateway..."
LOGIN_RESP=$(curl -s -i -X POST "$GATEWAY_URL/auth/mock-login" \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke-test@example.com","name":"Smoke Tester"}' \
  -c "$COOKIE_JAR")

if echo "$LOGIN_RESP" | grep -q "200 OK" && [ -f "$COOKIE_JAR" ]; then
  echo -e "${GREEN}✔ Authenticated successfully. Saved session cookies.${NC}"
else
  echo -e "${RED}✘ Failed to authenticate.${NC}"
  echo "$LOGIN_RESP"
  exit 1
fi

# 2. Check initial seats status
echo -e "\n2. Fetching current seat map..."
SEATS_RESP=$(curl -s -b "$COOKIE_JAR" "$GATEWAY_URL/seats")
echo "$SEATS_RESP" | grep -o '"number":"[^"]*","status":"[^"]*"' || echo "$SEATS_RESP"

# Ensure seat 1 (A1) and seat 2 (A2) are available
if ! echo "$SEATS_RESP" | grep -q '"id":1,"number":"A1","status":"available"'; then
  echo -e "${YELLOW}⚠ Seat A1 is not available. This is fine if running on a dirty DB, but test requires resetting or selecting another.${NC}"
fi

# 3. Pessimistic Lock (Hold) Seat A1
echo -e "\n3. Placing pessimistic hold on seat A1 (ID: 1)..."
HOLD_RESP=$(curl -s -L -b "$COOKIE_JAR" -X POST "$GATEWAY_URL/seats/1/lock" -H "Content-Type: application/json")
echo "Response: $HOLD_RESP"

if echo "$HOLD_RESP" | grep -q '"success":true'; then
  echo -e "${GREEN}✔ Hold placed successfully.${NC}"
else
  echo -e "${RED}✘ Failed to place hold on seat A1.${NC}"
  exit 1
fi

# Verify hold status in database
echo -e "\n4. Verifying seat A1 is now marked as HELD..."
SEATS_VERIFY=$(curl -s -b "$COOKIE_JAR" "$GATEWAY_URL/seats")
if echo "$SEATS_VERIFY" | grep -q '"id":1,"number":"A1","status":"held"'; then
  echo -e "${GREEN}✔ Seat A1 verified as 'held'.${NC}"
else
  echo -e "${RED}✘ Seat A1 is not marked as held.${NC}"
  echo "$SEATS_VERIFY"
  exit 1
fi

# 4. Initiate Successful Payment (Saga happy path)
echo -e "\n5. Initiating simulated checkout payment (SUCCESS)..."
PAY_RESP=$(curl -s -b "$COOKIE_JAR" -X POST "$GATEWAY_URL/seats/1/reserve" \
  -H "Content-Type: application/json" \
  -d '{"simulatedStatus":"success"}')
echo "Response: $PAY_RESP"

if echo "$PAY_RESP" | grep -q '"success":true'; then
  echo -e "${GREEN}✔ Simulated payment checkout registered.${NC}"
else
  echo -e "${RED}✘ Checkout initiation failed.${NC}"
  exit 1
fi

echo -e "\n6. Waiting for async webhook processing + Kafka outbox saga execution..."
sleep 8

echo -e "\n7. Verifying seat A1 is now permanently RESERVED..."
SEATS_VERIFY2=$(curl -s -b "$COOKIE_JAR" "$GATEWAY_URL/seats")
if echo "$SEATS_VERIFY2" | grep -q '"id":1,"number":"A1","status":"reserved"'; then
  echo -e "${GREEN}✔ SUCCESS: Seat A1 successfully finalized as 'reserved'!${NC}"
else
  echo -e "${RED}✘ Failed: Seat A1 is not reserved. Saga did not complete.${NC}"
  echo "$SEATS_VERIFY2"
  exit 1
fi

# 5. Initiate Failed Payment (Saga Compensation path)
echo -e "\n8. Testing Saga Compensation: Placing hold on seat A2 (ID: 2)..."
HOLD_RESP2=$(curl -s -L -b "$COOKIE_JAR" -X POST "$GATEWAY_URL/seats/2/lock" -H "Content-Type: application/json")
echo "Response: $HOLD_RESP2"

if echo "$HOLD_RESP2" | grep -q '"success":true'; then
  echo -e "${GREEN}✔ Hold placed successfully on seat A2.${NC}"
else
  echo -e "${RED}✘ Failed to place hold on seat A2.${NC}"
  exit 1
fi

echo -e "\n9. Initiating simulated checkout payment (FAIL)..."
PAY_RESP2=$(curl -s -b "$COOKIE_JAR" -X POST "$GATEWAY_URL/seats/2/reserve" \
  -H "Content-Type: application/json" \
  -d '{"simulatedStatus":"fail"}')
echo "Response: $PAY_RESP2"

if echo "$PAY_RESP2" | grep -q '"success":true'; then
  echo -e "${GREEN}✔ Simulated payment checkout registered (expecting eventual failure).${NC}"
else
  echo -e "${RED}✘ Checkout initiation failed.${NC}"
  exit 1
fi

echo -e "\n10. Waiting for failed webhook processing + compensation saga execution..."
sleep 8

echo -e "\n11. Verifying seat A2 is released back to AVAILABLE..."
SEATS_VERIFY3=$(curl -s -b "$COOKIE_JAR" "$GATEWAY_URL/seats")
if echo "$SEATS_VERIFY3" | grep -q '"id":2,"number":"A2","status":"available"'; then
  echo -e "${GREEN}✔ SUCCESS: Compensation Saga verified! Seat A2 is 'available' again.${NC}"
else
  echo -e "${RED}✘ Failed: Seat A2 is locked/held. Compensation saga failed.${NC}"
  echo "$SEATS_VERIFY3"
  exit 1
fi

echo -e "\n${GREEN}=== E2E Smoke Test Passed! Microservices Integration is Healthy ===${NC}"
rm -f "$COOKIE_JAR"
exit 0
