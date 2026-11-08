import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAdmin, type AuthedRequest } from './authRoutes.js';
import { AppError, ProjectService } from './projectService.js';
import {
  createTaskSchema,
  reorderSiblingsSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type ReorderSiblingsInput,
  type UpdateTaskInput,
} from './schemas.js';

interface Parseable<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: Array<{ path: PropertyKey[]; message: string }> };
      };
}

function parse<T>(schema: Parseable<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => {
        const path = issue.path.map(String).join('.');
        return `${path || 'body'}: ${issue.message}`;
      })
      .join('; ');
    throw new AppError('VALIDATION_ERROR', 400, message, result.error.issues);
  }
  return result.data;
}

export function createApiRouter(service: ProjectService): Router {
  const router = Router();

  const metaOf = (req: Request) => ({
    actor: (req as AuthedRequest).authUser?.username ?? 'web',
    origin: req.header('x-client-id') ?? undefined,
  });

  router.get('/tree', (_req, res) => {
    res.json(service.getTree());
  });

  router.get('/audit', (req, res) => {
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    res.json({ items: service.getAudit(rawLimit) });
  });

  router.post('/tasks/reorder', requireAdmin(), (req, res, next) => {
    try {
      const input = parse<ReorderSiblingsInput>(reorderSiblingsSchema, req.body);
      res.json(service.reorderSiblings(input.parent_id, input.ordered_ids, metaOf(req)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/tasks', requireAdmin(), (req, res, next) => {
    try {
      const input = parse<CreateTaskInput>(createTaskSchema, req.body);
      res.status(201).json(service.createTask(input, metaOf(req)));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/tasks/:id', requireAdmin(), (req, res, next) => {
    try {
      const input = parse<UpdateTaskInput>(updateTaskSchema, req.body);
      res.json(service.updateTask(String(req.params.id), input, metaOf(req)));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/tasks/:id', requireAdmin(), (req, res, next) => {
    try {
      const cascade = req.query.cascade !== 'false';
      res.json(service.deleteTask(String(req.params.id), cascade, metaOf(req)));
    } catch (error) {
      next(error);
    }
  });

  router.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
  });

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    console.error('API error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
  });

  return router;
}
