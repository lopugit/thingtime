#if THINGTIME_LOCAL_DEVELOPMENT
#import "ThingtimeLocalNode.h"
#include <cstdlib>
#include <cstring>
namespace node { int Start(int argc, char *argv[]); }
@implementation ThingtimeLocalNode
+ (void)startScript:(NSString *)script work:(NSString *)work origin:(NSString *)origin {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    setenv("THINGTIME_LOCAL_WORK",work.UTF8String,1);
    setenv("THINGTIME_LOCAL_ORIGIN",origin.UTF8String,1);
    unsetenv("NODE_OPTIONS"); unsetenv("NODE_PATH"); unsetenv("OPENSSL_CONF");
    [NSThread detachNewThreadWithBlock:^{ @autoreleasepool {
      char *args[]={strdup("node"),strdup(script.UTF8String)};
      node::Start(2,args); free(args[0]); free(args[1]);
    } }];
  });
}
@end
#endif
