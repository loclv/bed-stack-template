import "@testing-library/jest-dom";
import { afterEach, beforeAll } from "bun:test";
import { cleanup } from "@testing-library/react";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
	url: "http://localhost",
});

const { window } = dom;

global.document = window.document;
global.window = window as unknown as Window & typeof globalThis;
global.navigator = window.navigator;
global.localStorage = window.localStorage;

beforeAll(() => {
	const { getQueriesForElement, ...screen } = require("@testing-library/react");
});

afterEach(() => {
	cleanup();
});
