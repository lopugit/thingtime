#import <Foundation/Foundation.h>
NS_ASSUME_NONNULL_BEGIN
@interface ThingtimeLocalNode : NSObject
+ (BOOL)startScript:(NSString *)script work:(NSString *)work origin:(NSString *)origin protectedProfile:(nullable NSData *)profile;
+ (void)stop;
@end
NS_ASSUME_NONNULL_END
