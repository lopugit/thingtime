require "minitest/autorun"
require_relative "testflight_upload_status"

class TestFlightUploadStatusTest < Minitest::Test
  Upload = Struct.new(:platform, :cf_build_version, :cf_build_short_version_string, :state, :created_date, :uploaded_date, keyword_init: true)

  def test_projects_an_exact_failed_ios_upload_without_raw_diagnostics
    upload = Upload.new(platform: "IOS", cf_build_version: "58", cf_build_short_version_string: "1.0",
                        created_date: "2026-11-10T17:28:31+00:00", uploaded_date: "2026-11-10T17:28:32Z",
                        state: { "state" => "FAILED", "errors" => [
                          { "code" => "ITMS-90000", "description" => "Private diagnostic" },
                          { "code" => "ITMS-90000" }, { "code" => "unsafe\ntext" }
                        ] })

    assert_equal({ platform: "IOS", version: "1.0", build: "58", state: "FAILED",
                   created: "2026-11-10T17:28:31Z", uploaded: "2026-11-10T17:28:32Z",
                   errors: 3, errorCodes: ["ITMS-90000"] }, TestFlightUploadStatus.project(upload, "58"))
    assert_nil TestFlightUploadStatus.project(upload, "57")
    upload.platform = "MAC_OS"
    assert_nil TestFlightUploadStatus.project(upload, "58")
  end

  def test_preserves_known_processing_state_and_unknown_fields
    upload = Upload.new(platform: "IOS", cf_build_version: "58", state: { "state" => "PROCESSING" },
                        created_date: "unknown")
    status = TestFlightUploadStatus.project(upload, "58")

    assert_equal "PROCESSING", status[:state]
    assert_nil status[:version]
    assert_nil status[:created]
    assert_nil status[:errors]
    assert_empty status[:errorCodes]
    refute status.key?(:internal)
  end
end
