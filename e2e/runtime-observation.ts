import type { ConsoleMessage, Page, Request, Response } from "@playwright/test";

import { PHASE27_E2E_BASE_URL } from "../src/test/test-environment";

export type RuntimeObservation = {
  assertClean(): void;
};

export function observeRuntime(page: Page): RuntimeObservation {
  const failures: string[] = [];
  const applicationOrigin = new URL(PHASE27_E2E_BASE_URL).origin;

  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === "error") failures.push(`console.error: ${sanitizeText(message.text())}`);
  };
  const onPageError = (error: Error) => {
    failures.push(`pageerror: ${sanitizeText(error.message)}`);
  };
  const onRequestFailed = (request: Request) => {
    if (isApplicationUrl(request.url(), applicationOrigin)) {
      failures.push(
        `requestfailed: ${sanitizeUrl(request.url())} (${sanitizeText(request.failure()?.errorText ?? "unknown error")})`,
      );
    }
  };
  const onResponse = (response: Response) => {
    if (
      response.status() >= 500 &&
      response.status() <= 599 &&
      isApplicationUrl(response.url(), applicationOrigin)
    ) {
      failures.push(`response: ${response.status()} ${sanitizeUrl(response.url())}`);
    }
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);

  return {
    assertClean() {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("requestfailed", onRequestFailed);
      page.off("response", onResponse);
      if (failures.length > 0) {
        throw new Error(`Unexpected browser runtime failures:\n${failures.join("\n")}`);
      }
    },
  };
}

function isApplicationUrl(rawUrl: string, applicationOrigin: string) {
  try {
    return new URL(rawUrl).origin === applicationOrigin;
  } catch {
    return false;
  }
}

function sanitizeUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  return `${url.origin}${url.pathname}`;
}

function sanitizeText(text: string) {
  return text
    .replace(/https?:\/\/[^\s]+/gi, (rawUrl) => {
      try {
        return sanitizeUrl(rawUrl);
      } catch {
        return "[URL]";
      }
    })
    .replace(/(authorization|password|token|secret)(\s*[=:]\s*|\s+)[^\s,;]+/gi, "$1$2[REDACTED]")
    .slice(0, 1_000);
}
