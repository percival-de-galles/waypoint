#import <React/RCTViewManager.h>
#import <React/RCTUIManager.h>
#import "RCTBridge.h"
#import "Utils.h"

@interface WaypointMarkdownTextManager : RCTViewManager
@end

@implementation WaypointMarkdownTextManager

RCT_EXPORT_MODULE(WaypointMarkdownText)

- (UIView *)view
{
  return [[UIView alloc] init];
}

RCT_CUSTOM_VIEW_PROPERTY(color, NSString, UIView)
{
}

@end

@interface WaypointMarkdownTextRunManager : RCTViewManager
@end

@implementation WaypointMarkdownTextRunManager

RCT_EXPORT_MODULE(WaypointMarkdownTextRun)

- (UIView *)view
{
  return nil;
}

@end
