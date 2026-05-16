import { HttpInterceptorFn } from '@angular/common/http';

const TOKEN_STORAGE_KEY = 'spooty_auth_token';

export const authTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);

  if (!token) {
    return next(req);
  }

  return next(
    req.clone({
      setHeaders: {
        'x-spooty-token': token,
      },
    }),
  );
};
