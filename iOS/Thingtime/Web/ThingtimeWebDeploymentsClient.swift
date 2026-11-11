import Foundation

struct ThingtimeWebDeploymentsClient {
    enum ClientError: Error {
        case invalidResponse
        case requestFailed(Int)
    }

    var session: URLSession = .shared
    var requestURLs: [URL] = ThingtimeWebDestination.deploymentsAPIURLs()

    func fetchDeployments() async throws -> ThingtimeWebDestination.DeploymentsOverview {
        var fallbackOverview: ThingtimeWebDestination.DeploymentsOverview?
        var lastError: Error?

        for requestURL in requestURLs {
            do {
                let overview = try await fetchDeployments(from: requestURL)

                if overview.supportsDeploymentHistory {
                    return overview
                }

                if overview.fallbackDeploymentCount > (fallbackOverview?.fallbackDeploymentCount ?? -1) {
                    fallbackOverview = overview
                }
            } catch {
                lastError = error
            }
        }

        if let fallbackOverview {
            return fallbackOverview
        }

        throw lastError ?? ClientError.invalidResponse
    }

    private func fetchDeployments(
        from requestURL: URL
    ) async throws -> ThingtimeWebDestination.DeploymentsOverview {
        let (data, response) = try await session.data(from: requestURL)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ClientError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            throw ClientError.requestFailed(httpResponse.statusCode)
        }

        return try JSONDecoder().decode(ThingtimeWebDestination.DeploymentsOverview.self, from: data)
    }
}
