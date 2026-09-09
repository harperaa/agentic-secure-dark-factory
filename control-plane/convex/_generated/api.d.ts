/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as bridge from "../bridge.js";
import type * as decisions from "../decisions.js";
import type * as events from "../events.js";
import type * as factory from "../factory.js";
import type * as factoryTables from "../factoryTables.js";
import type * as gates from "../gates.js";
import type * as githubWebhook from "../githubWebhook.js";
import type * as http from "../http.js";
import type * as lib_factoryAuth from "../lib/factoryAuth.js";
import type * as lib_securityLogger from "../lib/securityLogger.js";
import type * as paymentAttemptTypes from "../paymentAttemptTypes.js";
import type * as paymentAttempts from "../paymentAttempts.js";
import type * as projects from "../projects.js";
import type * as runs from "../runs.js";
import type * as security from "../security.js";
import type * as seedSecurityEvents from "../seedSecurityEvents.js";
import type * as stateMachine from "../stateMachine.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  bridge: typeof bridge;
  decisions: typeof decisions;
  events: typeof events;
  factory: typeof factory;
  factoryTables: typeof factoryTables;
  gates: typeof gates;
  githubWebhook: typeof githubWebhook;
  http: typeof http;
  "lib/factoryAuth": typeof lib_factoryAuth;
  "lib/securityLogger": typeof lib_securityLogger;
  paymentAttemptTypes: typeof paymentAttemptTypes;
  paymentAttempts: typeof paymentAttempts;
  projects: typeof projects;
  runs: typeof runs;
  security: typeof security;
  seedSecurityEvents: typeof seedSecurityEvents;
  stateMachine: typeof stateMachine;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
