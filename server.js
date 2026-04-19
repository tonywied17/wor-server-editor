const path = require('path');
const {
  createApp,
  cors,
  errorHandler,
  helmet,
  json,
  logger,
  Router,
  static: serveStatic,
  env,
} = require('zero-http');
const steamRoutes = require('./routes/steam');
const ftpRoutes = require('./routes/ftp');

env.load({
  PORT: { type: 'port', default: 7272 },
  STEAM_API_KEY: { type: 'string', default: '' },
  CORS_ORIGIN: { type: 'string', default: '*' },
});

const app = createApp();

app.use(helmet());
app.use(logger());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(json({ limit: '5mb' }));

const api = Router();
api.use('/steam', steamRoutes);
api.use('/ftp', ftpRoutes);
app.use('/api', api);

app.use(serveStatic(path.join(__dirname, 'client', 'dist')));

app.get('/', (req, res) => res.json({ status: 'ok' }));

app.onError(errorHandler());

app.listen(env.PORT, () => console.log(`Server running on http://localhost:${env.PORT}`));
