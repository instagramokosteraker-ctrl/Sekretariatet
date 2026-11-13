import type { Request, Response } from 'express';

export default async function handler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { app } = await import('../server');
    app(req, res);
  } catch (error) {
    console.error('Vercel API initialization error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'API server initialization failed.',
      });
    }
  }
}
