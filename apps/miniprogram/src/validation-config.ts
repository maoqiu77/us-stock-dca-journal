import { z } from 'zod';
// Mini program hosts restrict dynamic code generation. Configure before the
// shared domain constructs schemas; no eval probe or JIT compilation is needed.
z.config({ jitless: true });
