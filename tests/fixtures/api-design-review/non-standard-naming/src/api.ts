interface UserProfile {
  // Non-standard naming: snake_case fields
  user_id: string;
  display_name: string;
  email_address: string;
}

export function getUser(userId: string): UserProfile {
  // GET /api/v1/users/:userId
  return {
    user_id: userId,
    display_name: "John Doe",
    email_address: "john.doe@example.com"
  };
}
