export function login(user: string, pass: string): boolean {
  console.log(`Attempting login for user: ${user} with password: ${pass}`);
  return user === "admin" && pass === "secret";
}
