interface Request {
  headers: Record<string, string>;
}

interface Response {
  json(data: any): void;
}

export function handleAdminData(req: Request, res: Response): void {
  // Missing authorization check here on route /api/admin/data, exposing sensitive data
  if (req.headers) {
    res.json({ secretKey: "12345-abcde", users: [] });
  }
}
