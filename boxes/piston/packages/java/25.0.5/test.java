public class Main {
    public static void main(String[] args) {
        // Named in full on purpose: this is what broke when `run` renamed the
        // file to Main.java.java.
        java.util.List<String> words = java.util.List.of("OK");
        System.out.println(words.get(0));
    }
}
