interface UserProfile {
  userId: string;
  displayName: string;
  emailAddress: string;
}

export function getUser(userId: string): UserProfile {
  // GET /api/v1/users/:userId
  // Secure endpoint with auth token check (handled in middleware)
  return {
    userId,
    displayName: "John Doe",
    emailAddress: "john.doe@example.com"
  };
}
