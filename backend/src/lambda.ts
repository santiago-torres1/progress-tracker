import serverless from 'serverless-http';

import { createApp } from './app.js';

/*
 * Lambda entrypoint: the image's CMD is "dist/lambda.handler". Handles Function URL events
 * (payload format 2.0). Configuration comes from the function's environment variables; this
 * module deliberately never loads .env.
 *
 * The app is built once per execution environment, during init, and reused across invocations.
 */
export const handler = serverless(createApp());
