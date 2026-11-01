#import "ShareItemProviderBridge.h"
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

@implementation ShareItemProviderBridge
+ (void)loadLivePhotoFromProvider:(NSItemProvider *)provider
                     completion:(void (^)(PHLivePhoto *, NSError *))completion {
    [provider loadItemForTypeIdentifier:UTTypeLivePhoto.identifier options:nil
                     completionHandler:(NSItemProviderCompletionHandler)^(PHLivePhoto *photo, NSError *error) {
        completion(photo, error);
    }];
}
+ (void)loadImageFromProvider:(NSItemProvider *)provider
              typeIdentifier:(NSString *)typeIdentifier
                  completion:(void (^)(UIImage *, NSError *))completion {
    [provider loadItemForTypeIdentifier:typeIdentifier options:nil
                     completionHandler:(NSItemProviderCompletionHandler)^(UIImage *image, NSError *error) {
        completion(image, error);
    }];
}
@end
