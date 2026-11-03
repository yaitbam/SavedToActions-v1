import { get, post } from "./client";
import type { AuthStatus } from "./types";

export const getAuthStatus = () => get<AuthStatus>("/auth/status");
export const disconnectGoogle = () => post<AuthStatus>("/auth/disconnect", {});
export const googleConnectUrl = "/auth/google";
