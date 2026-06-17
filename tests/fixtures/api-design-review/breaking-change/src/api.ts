interface UserProfile {
  // Breaking change: userId type changed from string to number
  userId: number;
  displayName: string;
  // Breaking change: emailAddress field was removed
}

export function getUser(userId: number): UserProfile {
  // GET /api/v1/users/:userId
  return {
    userId,
    displayName: "John Doe"
  };
}
