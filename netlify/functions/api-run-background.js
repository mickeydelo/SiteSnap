'use strict';
const path = require('path');

// esbuild cannot bundle an ESM .mjs entry into CJS output — it wraps it with
// require(), which always fails for ESM. This CJS shim uses a COMPUTED path for
// import() so esbuild leaves it as runtime code and never tries to require() it.
const IMPL_PATH = path.join(
  process.env.LAMBDA_TASK_ROOT ? process.env.LAMBDA_TASK_ROOT : process.cwd(),
  'netlify', 'functions', '_bg_impl.mjs',
);

exports.handler = async (event, context) => {
  const { handler } = await import(IMPL_PATH);
  return handler(event, context);
};
