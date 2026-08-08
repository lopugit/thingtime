export const ADMIN_PRIVATE_CACHE_CONTROL = 'private, no-store, max-age=0';

const applyAdminPrivateHeaders = (response: Response): Response => {
  response.headers.set('Cache-Control', ADMIN_PRIVATE_CACHE_CONTROL);
  response.headers.set('Pragma', 'no-cache');
  return response;
};

// Stamp both returned and thrown Responses. readJsonBody throws its size-limit
// response, so wrapping the whole loader/action keeps every admin path private.
export const withAdminPrivateResponse = async (handler: () => Response | Promise<Response>): Promise<Response> => {
  try {
    return applyAdminPrivateHeaders(await handler());
  } catch (error) {
    if (error instanceof Response) throw applyAdminPrivateHeaders(error);
    throw error;
  }
};
