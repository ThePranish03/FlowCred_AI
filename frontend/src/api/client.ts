import axios from "axios";
import { API_BASE_URL } from "@/lib/constants";
import { useAuthStore } from "@/stores/auth";

export interface ApiErrorShape {
  status?: number;
  message: string;
  detail?: unknown;
}

export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 45_000,
  headers: { "Content-Type": "application/json" },
});

http.interceptors.request.use((config) => {
  const accessToken = useAuthStore.getState().accessToken;
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshInFlight: Promise<string | null> | null = null;

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error?.response?.status as number | undefined;
    const original = error?.config;
    if (status === 401 && original && !original._flowcredRetried && !String(original.url).includes("/auth/")) {
      original._flowcredRetried = true;
      const { refreshToken, setSession, logout } = useAuthStore.getState();
      if (refreshToken) {
        refreshInFlight ??= http.post("/auth/refresh", { refreshToken })
          .then(({ data }) => {
            setSession(data.user, data.accessToken, data.refreshToken);
            return data.accessToken as string;
          })
          .catch(() => { logout(); return null; })
          .finally(() => { refreshInFlight = null; });
        const nextToken = await refreshInFlight;
        if (nextToken) {
          original.headers = original.headers ?? {};
          original.headers.Authorization = `Bearer ${nextToken}`;
          return http.request(original);
        }
      }
    }
    const detail = error?.response?.data?.detail ?? error?.response?.data?.message;
    const detailMessage = typeof detail === "object" && detail !== null && "message" in detail
      ? String((detail as { message: unknown }).message)
      : undefined;
    const message =
      detailMessage ||
      (typeof detail === "string" && detail) ||
      (status ? `Request failed with status ${status}.` : "The backend could not be reached.");
    return Promise.reject({ status, message, detail } satisfies ApiErrorShape);
  },
);

export async function request<T>(config: Parameters<typeof http.request>[0]): Promise<T> {
  const response = await http.request<T>(config);
  return response.data;
}
