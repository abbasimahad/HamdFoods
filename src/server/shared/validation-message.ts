import type { z } from "zod";

/**
 * Turns a Zod issue into a message safe and useful for a non-technical end
 * user: which field, in plain English, rather than Zod's internal wording
 * (e.g. "Too small: expected string to have >=5 characters") or a bare
 * "Invalid UUID" for an empty required dropdown.
 */
export function describeValidationIssue(issue: z.core.$ZodIssue | undefined): string | undefined {
  if (!issue) return undefined;
  const field = humanizeFieldName(issue.path);
  const body = describeIssueBody(issue);
  return field ? `${field} ${body}` : capitalize(body);
}

function humanizeFieldName(path: ReadonlyArray<PropertyKey>): string | undefined {
  const first = path[0];
  if (typeof first !== "string" || first.length === 0) return undefined;
  const withoutId = first.replace(/Ids?$/, "");
  const spaced = withoutId.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return capitalize(spaced);
}

function describeIssueBody(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "too_small": {
      const unit = issue.origin === "string" ? " characters" : "";
      return `must be at least ${issue.minimum}${unit}`;
    }
    case "too_big": {
      const unit = issue.origin === "string" ? " characters" : "";
      return `must be at most ${issue.maximum}${unit}`;
    }
    case "invalid_format":
      if (issue.format === "uuid") return "must be selected";
      if (issue.format === "email") return "must be a valid email address";
      return "is not valid";
    case "invalid_type":
      return "is required";
    default:
      return issue.message;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
