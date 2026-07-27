import type { RouteGroupCommandErrorCode } from "../../shared/routeGroupApi.js";

export type RouteGroupCommandErrorParams = Record<
  string,
  string | number | boolean | null
>;

export class RouteGroupCommandError extends Error {
  constructor(
    readonly code: RouteGroupCommandErrorCode,
    readonly params: RouteGroupCommandErrorParams = {},
  ) {
    super(code);
    this.name = "RouteGroupCommandError";
  }
}
