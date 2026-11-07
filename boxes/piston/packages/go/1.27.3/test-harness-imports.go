// Builds the seed cache (setup.sh), and is the program the smoke test times.
//
// The first two groups must cover HARNESS_IMPORTS and GO_CONVENIENCE_IMPORTS in
// PM-Interview-Bank's lib/coding/codegen/go.ts. The third is what solutions
// commonly import themselves.
package main

import (
	_ "bytes"
	_ "encoding/json"
	"fmt"
	_ "io"
	_ "log"
	_ "math"
	_ "os"
	_ "reflect"
	_ "runtime/debug"
	_ "sort"
	_ "strconv"
	_ "strings"
	_ "time"

	_ "container/heap"
	_ "container/list"
	_ "math/bits"
	_ "unicode"

	_ "bufio"
	_ "cmp"
	_ "container/ring"
	_ "context"
	_ "errors"
	_ "hash/fnv"
	_ "maps"
	_ "math/big"
	_ "math/rand"
	_ "regexp"
	_ "slices"
	_ "sync"
	_ "sync/atomic"
	_ "unicode/utf8"
)

func main() {
	fmt.Println("OK")
}
