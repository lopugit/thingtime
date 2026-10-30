#import <Foundation/Foundation.h>
#import <Photos/Photos.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// loadItem uses the concrete Objective-C completion parameter to negotiate an
/// object class. Swift's NSSecureCoding completion erases that class metadata.
@interface ShareItemProviderBridge : NSObject
+ (void)loadLivePhotoFromProvider:(NSItemProvider *)provider
                     completion:(void (^)(PHLivePhoto * _Nullable, NSError * _Nullable))completion
    NS_SWIFT_NAME(loadLivePhoto(from:completion:));
+ (void)loadImageFromProvider:(NSItemProvider *)provider
              typeIdentifier:(NSString *)typeIdentifier
                  completion:(void (^)(UIImage * _Nullable, NSError * _Nullable))completion
    NS_SWIFT_NAME(loadImage(from:typeIdentifier:completion:));
@end

NS_ASSUME_NONNULL_END
