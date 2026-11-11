#import <Foundation/Foundation.h>
NS_ASSUME_NONNULL_BEGIN
@interface ThingtimeLocalNode : NSObject
+ (void)startScript:(NSString *)script work:(NSString *)work origin:(NSString *)origin;
@end
NS_ASSUME_NONNULL_END
