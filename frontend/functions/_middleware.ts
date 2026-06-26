export const onRequest = async (context: { request: Request; next: () => Promise<Response> }) => {
  const url = new URL(context.request.url);
  if (url.pathname.startsWith('/api/')) {
    url.hostname = 'faze-up.onrender.com';
    return fetch(url.toString(), context.request);
  }
  return context.next();
};
