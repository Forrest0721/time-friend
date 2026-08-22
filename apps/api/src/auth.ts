import type { FastifyRequest } from "fastify";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { fromNodeHeaders } from "better-auth/node";
import { v7 as uuidv7 } from "uuid";

import { schema, TimeFriendDatabase } from "@time-friend/db";

import type { AuthenticatedUser } from "./types.js";

export interface AuthConfiguration {
  baseURL: string;
  secret: string;
  trustedOrigins: readonly string[];
  secureCookies: boolean;
  onUserCreated?(userId: string): Promise<void>;
}

export function createTimeFriendAuth(database: TimeFriendDatabase, configuration: AuthConfiguration) {
  return betterAuth({
    appName: "Time Friend",
    baseURL: configuration.baseURL,
    secret: configuration.secret,
    trustedOrigins: [...configuration.trustedOrigins],
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
    },
    user: {
      additionalFields: {
        timezone: { type: "string", required: false, defaultValue: "Asia/Shanghai", input: false },
        weekStartsOn: { type: "number", required: false, defaultValue: 1, input: false },
        agentEnabled: { type: "boolean", required: false, defaultValue: true, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    databaseHooks: configuration.onUserCreated
      ? {
          user: {
            create: {
              after: async (user) => configuration.onUserCreated!(user.id),
            },
          },
        }
      : undefined,
    advanced: {
      database: {
        generateId: () => uuidv7(),
      },
      defaultCookieAttributes: {
        httpOnly: true,
        secure: configuration.secureCookies,
        sameSite: "lax",
        path: "/",
      },
    },
  });
}

export type TimeFriendAuth = ReturnType<typeof createTimeFriendAuth>;

export async function resolveAuthenticatedUser(auth: TimeFriendAuth, request: FastifyRequest): Promise<AuthenticatedUser | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    timezone: session.user.timezone ?? "Asia/Shanghai",
    weekStartsOn: 1,
    agentEnabled: session.user.agentEnabled ?? true,
  };
}

export function handleAuthRequest(auth: TimeFriendAuth, request: FastifyRequest): Promise<Response> {
  const protocol = request.protocol;
  const host = request.headers.host ?? "localhost";
  const url = new URL(request.url, `${protocol}://${host}`);
  const body = request.body === undefined ? undefined : JSON.stringify(request.body);
  return auth.handler(
    new Request(url, {
      method: request.method,
      headers: fromNodeHeaders(request.headers),
      ...(body === undefined ? {} : { body }),
    }),
  );
}
