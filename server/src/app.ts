import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import swaggerUi from 'swagger-ui-express';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/public';
import { driverPortalRouter } from './routes/driver';
import { usersRouter, rolesRouter } from './routes/users';
import { associationsRouter } from './routes/associations';
import { driversRouter } from './routes/drivers';
import { vehiclesRouter } from './routes/vehicles';
import { financeRouter } from './routes/finance';
import { reportsRouter } from './routes/reports';
import { documentsRouter } from './routes/documents';
import { announcementsRouter } from './routes/announcements';
import { dashboardRouter } from './routes/dashboard';
import { auditRouter, filesRouter, orgRouter } from './routes/misc';
import { authenticate } from './middleware/auth';
import { errorHandler } from './lib/http';
import { openapi } from './openapi';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: (process.env.WEB_ORIGIN || 'http://localhost:5173').split(','), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.get('/api/openapi.json', (_req, res) => res.json(openapi));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'TODAnaTo API' }));

  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/driver', driverPortalRouter);
  // Everything below requires a signed-in admin user.
  app.use('/api', authenticate);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/roles', rolesRouter);
  app.use('/api/associations', associationsRouter);
  app.use('/api/drivers', driversRouter);
  app.use('/api/vehicles', vehiclesRouter);
  app.use('/api/finance', financeRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/announcements', announcementsRouter);
  app.use('/api/audit-logs', auditRouter);
  app.use('/api/organizations', orgRouter);
  app.use('/api/files', filesRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // In production the API also serves the built web app.
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
