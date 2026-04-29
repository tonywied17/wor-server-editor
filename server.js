const path = require('path');
const {
  Router,
  createApp,
} = require('@zero-server/core');
const {
  cors,
  errorHandler,
  helmet,
  logger,
  static: serveStatic,
} = require('@zero-server/middleware');
const { json } = require('@zero-server/body');
const { env } = require('@zero-server/env');
const steamRoutes = require('./routes/steam');
const ftpRoutes = require('./routes/ftp');

env.load({
  PORT: { type: 'port', default: 7272 },
  STEAM_API_KEY: { type: 'string', default: '' },
  CORS_ORIGIN: { type: 'string', default: '*' },
});

const app = createApp();

const isProduction = process.env.NODE_ENV === 'production';
const configuredOrigins = env.CORS_ORIGIN.includes(',')
  ? env.CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean)
  : [env.CORS_ORIGIN];
const corsOrigins = isProduction
  ? configuredOrigins
  : Array.from(new Set([
    ...configuredOrigins,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:7272',
    'http://127.0.0.1:7272',
  ]));

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      connectSrc: ["'self'", 'https://media-api.molex.cloud'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
    },
  },
}));
app.use(logger());
app.use(cors({
  origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
  methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type,Authorization,X-Requested-With,Accept,Origin',
  maxAge: 86400,
}));
app.use(json({ limit: '5mb' }));

const api = Router();
api.use('/steam', steamRoutes);
api.use('/ftp', ftpRoutes);
app.use('/api', api);

app.use(serveStatic(path.join(__dirname, 'client', 'dist')));

app.get('/', (req, res) => res.json({ status: 'ok' }));

app.onError(errorHandler());

app.listen(env.PORT, () => console.log(`Server running on http://localhost:${env.PORT}`));
