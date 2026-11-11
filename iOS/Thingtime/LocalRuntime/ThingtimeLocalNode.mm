#if THINGTIME_LOCAL_DEVELOPMENT
#import "ThingtimeLocalNode.h"
#include <cstdlib>
#include <cstring>
#include <unistd.h>
#include <fcntl.h>
#include <cerrno>
#include <limits.h>
static int shutdownWrite = -1;
static bool privatePipe(int descriptors[2]) {
  if (pipe(descriptors)) return false;
  for (int i = 0; i < 2; i++) if (fcntl(descriptors[i], F_SETFD, FD_CLOEXEC) == -1) { close(descriptors[0]); close(descriptors[1]); descriptors[0] = descriptors[1] = -1; return false; }
  if (fcntl(descriptors[1], F_SETNOSIGPIPE, 1) == -1) { close(descriptors[0]); close(descriptors[1]); descriptors[0] = descriptors[1] = -1; return false; }
  return true;
}
namespace node { int Start(int argc, char *argv[]); }
@implementation ThingtimeLocalNode
+ (BOOL)startScript:(NSString *)script work:(NSString *)work origin:(NSString *)origin protectedProfile:(NSData *)profile {
  static dispatch_once_t once;
  __block BOOL accepted = NO;
  dispatch_once(&once, ^{
    int protectedPipe[2] = {-1,-1}, control[2] = {-1,-1};
    unsetenv("THINGTIME_NATIVE_PROFILE_FD"); unsetenv("THINGTIME_NATIVE_CONTROL_FD");
    if (profile) {
      if (!privatePipe(protectedPipe) || !privatePipe(control)) {
        for (int fd : protectedPipe) if (fd >= 0) close(fd);
        for (int fd : control) if (fd >= 0) close(fd);
        return;
      }
      // The validated envelope is smaller than PIPE_BUF; no plaintext file/argv/env.
      if (profile.length > PIPE_BUF || write(protectedPipe[1], profile.bytes, profile.length) != (ssize_t)profile.length) {
        for (int fd : protectedPipe) close(fd); for (int fd : control) close(fd);
        return;
      }
      close(protectedPipe[1]);
      setenv("THINGTIME_NATIVE_PROFILE_FD",[[NSString stringWithFormat:@"%d",protectedPipe[0]] UTF8String],1);
      setenv("THINGTIME_NATIVE_CONTROL_FD",[[NSString stringWithFormat:@"%d",control[0]] UTF8String],1);
      shutdownWrite = control[1];
    }
    setenv("THINGTIME_LOCAL_WORK",work.UTF8String,1);
    setenv("THINGTIME_LOCAL_ORIGIN",origin.UTF8String,1);
    unsetenv("NODE_OPTIONS"); unsetenv("NODE_PATH"); unsetenv("OPENSSL_CONF");
    accepted = YES;
    [NSThread detachNewThreadWithBlock:^{ @autoreleasepool {
      char *args[]={strdup("node"),strdup(script.UTF8String)};
      node::Start(2,args); free(args[0]); free(args[1]);
    } }];
  });
  return accepted;
}
+ (void)stop {
  @synchronized(self) { if (shutdownWrite >= 0) { const char signal = 1; write(shutdownWrite, &signal, 1); close(shutdownWrite); shutdownWrite = -1; } }
}
@end
#endif
