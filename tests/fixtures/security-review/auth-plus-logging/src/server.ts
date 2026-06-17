interface Request {
  headers: Record<string, string>;
}

interface Response {
  json(data: any): void;
}

export function handleAdminData(req: Request, res: Response, pass: string): void {
  // Unsafe logging of password
  console.log(`Accessing admin data with pass: ${pass}`);
  // Dummy read of req to satisfy TS unused parameters check
  if (req.headers) {
    // Missing authorization check on route /api/admin/data
    res.json({ secretKey: "12345-abcde" });
  }
}
