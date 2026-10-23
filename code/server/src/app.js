import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import routes from './routes/index.js';

// The Express app is built here (not started) so tests can import it without opening a port.
const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: '100kb' }));

app.use('/api/v1', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
