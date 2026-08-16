package domain

import "testing"

func TestMaskIP(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"", ""},
		{"77.90.63.29", "77.90.63.···"},
		{"5.231.118.220", "5.231.118.···"},
		{"::ffff:77.90.63.29", "77.90.63.···"},
		{"::ffff:77.90.63.29/128", "77.90.63.···"},
		{"5.231.118.220/32", "5.231.118.···"},
		{"2001:db8:85a3::8a2e:370:7334", "2001:db8:····"},
		{"2001:db8:85a3::8a2e:370:7334/64", "2001:db8:····"},
		{"2001:db8::1", "2001:db8:····"},
	}
	for _, c := range cases {
		if got := MaskIP(c.in); got != c.want {
			t.Errorf("MaskIP(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}