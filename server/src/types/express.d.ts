import 'http';

// express.Request extends http.IncomingMessage, so augmenting IncomingMessage
// here is inherited by both express.json()'s `verify` callback (which types
// req as bare http.IncomingMessage) and by express.Request in route handlers.
// Augmenting express-serve-static-core.Request directly does NOT work — the
// verify callback's req type is never Request, only IncomingMessage.
declare module 'http' {
  interface IncomingMessage {
    rawBody?: Buffer;
  }
}
