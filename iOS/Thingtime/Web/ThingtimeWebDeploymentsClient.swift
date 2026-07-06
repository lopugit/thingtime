import Foundation

struct ThingtimeWebDeploymentsClient {
    enum ClientError: Error {
        case invalidResponse
        case requestFailed(Int)
    }

    var session: URLSession = .shared
    var requestURL: URL = ThingtimeWebDestination.deploymentsAPIURL()

    func fetchDeployments() async throws -> [ThingtimeWebDestination.DeploymentSummary] {
        let (data, response) = try await session.data(from: requestURL)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ClientError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            throw ClientError.requestFailed(httpResponse.statusCode)
        }

        let overview = try JSONDecoder().decode(ThingtimeWebDestination.DeploymentsOverview.self, from: data)
        return overview.deployments
    }
}
