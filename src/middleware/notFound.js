export function notFound(_req, res) {
  res.status(404).json({ error: { message: 'Not Found' } });
}

