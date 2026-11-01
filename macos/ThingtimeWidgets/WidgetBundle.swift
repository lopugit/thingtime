import SwiftUI
import WidgetKit

@main
struct ThingtimeDesktopWidgetBundle: WidgetBundle {
    var body: some Widget {
        ThingtimeActionWidget()
        ThingtimeDashboardWidget()
        ThingtimeRenderWidget()
        ThingtimeRecentWidget()
    }
}
