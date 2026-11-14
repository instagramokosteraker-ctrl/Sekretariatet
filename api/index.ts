import type { Request, Response } from 'express';
import { app } from '../server';

export default function handler(req: Request, res: Response): void {
  try {
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
