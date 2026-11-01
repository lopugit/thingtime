package com.thingtime.mobile;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.IOException;

public class SessionCookieTest {
    @Test public void pinsOnlyTheExactAuthenticationCookie() throws Exception {
        String pinned=SessionCookie.auth("tt_auth=encoded==; tt_accounts=first; preference=one");
        assertEquals("tt_auth=encoded==",pinned);
        assertEquals(pinned,SessionCookie.auth("preference=two; tt_accounts=refreshed; tt_auth=encoded=="));
        assertNotEquals(pinned,SessionCookie.auth("tt_auth=another-session"));
    }
    @Test public void refusesMissingAmbiguousOrMalformedSessions() {
        for(String input:new String[]{null,"","tt_accounts=roster","tt_auth=","tt_auth=a; tt_auth=b","tt_auth=a; tt_auth=a","tt_auth=a b","tt_auth=a\r\nOther: value"})
            assertThrows(IOException.class,()->SessionCookie.auth(input));
    }
}
