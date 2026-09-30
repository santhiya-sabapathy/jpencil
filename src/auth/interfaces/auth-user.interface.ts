/** Claims stored in the JWT access token. */
export interface JwtPayload {
  sub: number;
  email: string;
}

/** Shape of `request.user` after JwtAuthGuard has run. */
export interface AuthUser {
  id: number;
  email: string;
}
