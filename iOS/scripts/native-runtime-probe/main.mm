#import <UIKit/UIKit.h>
#import <dispatch/dispatch.h>
#include <cstdlib>
#include <cstring>
namespace node { int Start(int argc, char *argv[]); }
@interface ProbeSceneDelegate : UIResponder <UIWindowSceneDelegate>
@property(strong,nonatomic) UIWindow *window;
@end
@implementation ProbeSceneDelegate
- (void)scene:(UIScene*)scene willConnectToSession:(UISceneSession*)session options:(UISceneConnectionOptions*)options {
  if (![scene isKindOfClass:UIWindowScene.class]) return;
  self.window=[[UIWindow alloc] initWithWindowScene:(UIWindowScene*)scene];
  UIViewController *controller=[UIViewController new];
  controller.view.backgroundColor=UIColor.whiteColor;
  self.window.rootViewController=controller;
  [self.window makeKeyAndVisible];
}
@end
@interface ProbeDelegate : UIResponder <UIApplicationDelegate>
@end
@implementation ProbeDelegate
- (BOOL)application:(UIApplication*)application didFinishLaunchingWithOptions:(NSDictionary*)options {
  static dispatch_once_t nodeOnce;
  dispatch_once(&nodeOnce, ^{
    NSString *script=[[NSBundle mainBundle] pathForResource:@"probe" ofType:@"mjs"];
    NSString *documents=NSSearchPathForDirectoriesInDomains(NSDocumentDirectory,NSUserDomainMask,YES).firstObject;
    setenv("PROBE_REPORT",[[documents stringByAppendingPathComponent:@"nitro-import.json"] UTF8String],1);
    setenv("NODE_ENV","production",1);
    setenv("HOST","127.0.0.1",1);
    setenv("PORT","29941",1);
    unsetenv("NODE_OPTIONS"); unsetenv("NODE_PATH"); unsetenv("OPENSSL_CONF");
    [NSThread detachNewThreadWithBlock:^{ @autoreleasepool {
      char *args[]={strdup("node"),strdup(script.UTF8String)};
      node::Start(2,args);
      free(args[0]); free(args[1]);
    } }];
  });
  return YES;
}
@end
int main(int argc,char **argv) {
  @autoreleasepool { return UIApplicationMain(argc,argv,nil,NSStringFromClass(ProbeDelegate.class)); }
}
