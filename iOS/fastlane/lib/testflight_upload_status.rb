require "time"

module TestFlightUploadStatus
  STATES = %w[AWAITING_UPLOAD PROCESSING FAILED COMPLETE].freeze
  VERSION_NUMBER = /\A\d+(?:\.\d+){0,2}\z/

  def self.project(upload, expected_build_number)
    return unless upload.platform == "IOS" && upload.cf_build_version == expected_build_number
    return unless VERSION_NUMBER.match?(expected_build_number)

    details = upload.state.is_a?(Hash) ? upload.state : {}
    state = details["state"]
    errors = details["errors"]
    version = upload.cf_build_short_version_string
    {
      platform: "IOS",
      version: VERSION_NUMBER.match?(version.to_s) ? version : nil,
      build: expected_build_number,
      state: STATES.include?(state) ? state : "UNAVAILABLE",
      created: timestamp(upload.created_date),
      uploaded: timestamp(upload.uploaded_date),
      errors: errors.is_a?(Array) ? errors.length : nil,
      errorCodes: error_codes(errors)
    }
  end

  def self.timestamp(value)
    Time.iso8601(value).utc.iso8601 if value.is_a?(String)
  rescue ArgumentError
    nil
  end

  def self.error_codes(errors)
    return [] unless errors.is_a?(Array)

    errors.filter_map do |error|
      next unless error.is_a?(Hash)

      code = error["code"]
      code if code.is_a?(String) && /\A[A-Z0-9][A-Z0-9._-]{0,63}\z/.match?(code)
    end.uniq
  end
end
