import SwiftUI
import WebKit

struct ThingtimeWebView: View {
    private let homeURL = ThingtimeWebDestination.home

    var body: some View {
        WebView(url: homeURL)
            .ignoresSafeArea(.container, edges: .bottom)
    }
}

#Preview {
    ThingtimeWebView()
}
