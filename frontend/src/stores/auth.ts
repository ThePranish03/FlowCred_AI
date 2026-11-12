import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Role, SessionUser } from "@/types";
import { APP_NAME } from "@/lib/constants";
import { API_BASE_URL } from "@/lib/constants";

const DEMO_PROFILES: Record<Role, { name: string; email: string }> = {
  admin: { name: "Alex Morgan", email: "admin@flowcred.ai" },
  business_owner: { name: "Priya Nair", email: "owner@flowcred.ai" },
  accountant: { name: "Daniel Reed", email: "accountant@flowcred.ai" },
  collections: { name: "Maya Chen", email: "collections@flowcred.ai" },
};

interface AuthState {
  user: SessionUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  login: (role: Role, email?: string) => SessionUser;
  setSession: (user: SessionUser, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  updateProfile: (updates: Partial<Pick<SessionUser, "name" | "email" | "company">>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      login: (role, email) => {
        const profile = DEMO_PROFILES[role];
        const user: SessionUser = {
          id: `user-${role}`,
          name: profile.name,
          email: email?.trim() || profile.email,
          role,
          company: `${APP_NAME} Demo Workspace`,
        };
        set({ user });
        return user;
      },
      setSession: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken }),
      logout: () => {
        const { accessToken, refreshToken } = get();
        if (accessToken && refreshToken) {
          void fetch(`${API_BASE_URL}/auth/logout`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ refreshToken }),
          }).catch(() => undefined);
        }
        set({ user: null, accessToken: null, refreshToken: null });
      },
      updateProfile: (updates) =>
        set((state) => (state.user ? { user: { ...state.user, ...updates } } : state)),
    }),
    { name: "flowcred-auth", version: 1 },
  ),
);

export function demoProfileForRole(role: Role) {
  return DEMO_PROFILES[role];
}
