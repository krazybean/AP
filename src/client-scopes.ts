export interface ClientScope {
  methods: string[];
  path: string;
}

const MAX_SCOPES = 32;
const MAX_METHODS = 16;
const MAX_PATH = 2_048;
const METHOD = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function validateScopes(input: unknown): ClientScope[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_SCOPES) throw new Error("INVALID_SCOPES");
  return input.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("INVALID_SCOPES");
    const scope = candidate as Record<string, unknown>;
    if (Object.keys(scope).some((key) => key !== "methods" && key !== "path")) throw new Error("INVALID_SCOPES");
    if (!Array.isArray(scope.methods) || scope.methods.length === 0 || scope.methods.length > MAX_METHODS || typeof scope.path !== "string") throw new Error("INVALID_SCOPES");
    const path = scope.path;
    if (path.length === 0 || path.length > MAX_PATH || !path.startsWith("/") || path.includes("?") || path.includes("#") || path.includes("%") || path.includes("\\") || path.includes("//") || path.split("/").some((segment) => segment === "." || segment === "..") || path.includes("**") || (path.includes("*") && !path.endsWith("/*")) || (path.endsWith("/*") && path.slice(0, -2).includes("*"))) throw new Error("INVALID_SCOPES");
    const methods = scope.methods.map((method) => {
      if (typeof method !== "string" || !METHOD.test(method)) throw new Error("INVALID_SCOPES");
      return method.toUpperCase();
    });
    if (new Set(methods).size !== methods.length) throw new Error("INVALID_SCOPES");
    return { methods, path };
  });
}

export function canonicalApplicationPath(path: string) {
  if (!path.startsWith("/") || /%(?:2f|5c)/i.test(path)) throw new Error("AMBIGUOUS_PATH");
  const query = path.indexOf("?");
  const withoutQuery = query < 0 ? path : path.slice(0, query);
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    throw new Error("AMBIGUOUS_PATH");
  }
  if (!decoded.startsWith("/") || /[^\x00-\x7F]/.test(decoded) || decoded.includes("%") || decoded.includes("#") || decoded.includes("\\") || decoded.includes("//") || decoded.split("/").some((segment) => segment === "." || segment === "..")) throw new Error("AMBIGUOUS_PATH");
  return decoded || "/";
}

export function canonicalDispatchPath(path: string) {
  const query = path.indexOf("?");
  const rawPath = query < 0 ? path : path.slice(0, query);
  return `${canonicalApplicationPath(rawPath)}${query < 0 ? "" : path.slice(query)}`;
}

export function scopeAllows(scopes: ClientScope[], method: string, path: string) {
  const normalizedMethod = method.toUpperCase();
  return scopes.some((scope) => {
    if (!scope.methods.includes(normalizedMethod)) return false;
    if (scope.path === "/*") return true;
    if (!scope.path.endsWith("/*")) return scope.path === path;
    const prefix = scope.path.slice(0, -2);
    return path.startsWith(`${prefix}/`) && path.length > prefix.length + 1;
  });
}
