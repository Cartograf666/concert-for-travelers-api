import Module from 'module';

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'typescript' || request.startsWith('typescript/')) {
    const redirectedRequest = request.replace(/^typescript/, 'typescript-v5');
    return originalResolveFilename.call(this, redirectedRequest, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
