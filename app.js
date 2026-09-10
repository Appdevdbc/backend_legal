import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import router from "./router/index.js";
import swaggerUi from "swagger-ui-express";
import * as dotenv from 'dotenv'; 
dotenv.config()
import { cekToken } from "./middleware/verifyToken.js";
import sqlSanitizeMiddleware from "./middleware/sanitizeRequest.js"; 
import { executeCron } from "./middleware/scheduler.js";
import cookieParser from "cookie-parser";
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const port = process.env.PORT;
const fe = process.env.FE_PORT;

/* app.use((req, res, next) => {
  const referringDomain = req.get('Referer');
  // Check if the referring domain is a specific domain
  if (referringDomain && referringDomain.includes('dbc.co.id')) {
    res.setHeader('Referer-Policy', 'strict-origin');
  } else {
    res.setHeader('Referer-Policy', 'same-origin');
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PATCH,POST,HEAD, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, Content-Type, X-Auth-Token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  next();
}); */

app.disable("x-powered-by");
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'file')));

// Explicit allow-list dari ENV (comma-separated). Dilarang wildcard '*' bersama credentials.
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// origin callback: SELALU echo origin spesifik (bukan '*') agar aman dengan credentials:true
const corsOriginResolver = (origin, callback) => {
  // Non-browser / same-origin (curl, server-to-server) tidak mengirim Origin
  if (!origin) return callback(null, true);

  const isProdLike = process.env.ENVIRONMENT === 'UAT' || process.env.ENVIRONMENT === 'PRODUCTION';
  const allowed = corsOrigins.includes(origin) || (isProdLike && /\.dbc\.co\.id$/.test(origin));

  if (allowed) {
    callback(null, true); // cors akan echo origin ini, bukan '*'
  } else {
    console.log(`CORS blocked for origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  }
};

app.use(cors({
  origin: corsOriginResolver,
  credentials: true,
}));

executeCron();

//app.options('*', cors());
import swaggerDocument from "./swagger-output.json" assert { type: "json" };
app.use("/doc", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use(cookieParser());
app.use(cekToken);
app.use(sqlSanitizeMiddleware);
app.use("/", router);

app.use((req, res) => {
  res.status(404).json({ message: "Not found" });
});

app.listen(port, () => {
  console.log(`WJS Backend listening on port ${port}`);
});


